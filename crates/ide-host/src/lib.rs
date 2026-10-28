//! The IDE backend without a UI toolkit: open projects per window, terminals,
//! processes, settings and the remote services. The desktop shell (`src-tauri`)
//! wraps one [`Host`] and adds windows, menus and plugins; `openidea-server`
//! runs one on a remote machine and serves it over JSON-RPC ([`rpc`]).

pub mod notebook;
pub mod ops;
mod project;
pub mod rpc;
pub mod shell_env;

pub use project::{Project, apply_git_executable, apply_workspace_edit, history_retention};

use ide_core::{CancellationToken, IdeError, IdeResult, RequestId, SharedSink};
use ide_language::{LanguageRegistry, Syntax};
use ide_run::ProcessManager;
use ide_terminal::TerminalManager;
use ide_workspace::SettingsStore;
use parking_lot::{Mutex, RwLock};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};

/// Event sink for one window (by label).
pub type SinkFactory = Box<dyn Fn(&str) -> SharedSink + Send + Sync>;

pub struct HostConfig {
    pub config_dir: PathBuf,
    pub data_dir: PathBuf,
    pub languages: Arc<LanguageRegistry>,
    /// Grammars, possibly still being built on another thread.
    pub syntax: Arc<OnceLock<Arc<Syntax>>>,
    pub sink_for: SinkFactory,
    /// The window that owns what `window` starts (e.g. a settings window's parent).
    pub owner: fn(&str) -> &str,
    pub runtime: tokio::runtime::Handle,
}

pub struct Host {
    pub config_dir: PathBuf,
    pub data_dir: PathBuf,
    pub languages: Arc<LanguageRegistry>,
    syntax: Arc<OnceLock<Arc<Syntax>>>,
    pub global_settings: SettingsStore,
    pub terminals: TerminalManager,
    pub processes: ProcessManager,
    /// Debug sessions (adapters run on this machine, next to the project).
    pub debugger: Arc<ide_dap::DebugManager>,
    /// SSH connections of Settings › SSH Configurations.
    pub ssh: Arc<ide_ssh::SshManager>,
    /// SFTP deployment, remote file editing and runs on run targets.
    pub remote: Arc<ide_remote::RemoteService>,
    pub(crate) sink_for: SinkFactory,
    owner: fn(&str) -> &str,
    pub runtime: tokio::runtime::Handle,
    /// One project per window, keyed by window label.
    projects: RwLock<HashMap<String, Arc<Project>>>,
    requests: Mutex<HashMap<RequestId, CancellationToken>>,
}

impl Host {
    pub fn new(config: HostConfig) -> Self {
        let HostConfig { config_dir, data_dir, languages, syntax, sink_for, owner, runtime } = config;
        let global_settings = SettingsStore::load(&config_dir, None);
        let ssh = Arc::new(ide_ssh::SshManager::new(data_dir.join("ssh-passwords.json")));
        ssh.set_configs(global_settings.effective().ssh.configs);
        Self {
            remote: Arc::new(ide_remote::RemoteService::new(ssh.clone(), data_dir.join("remote"))),
            ssh,
            global_settings,
            // Sessions, runs and terminals report to the window that started them (`window_sink`).
            terminals: TerminalManager::new(),
            processes: ProcessManager::new(),
            debugger: ide_dap::DebugManager::new(languages.clone()),
            languages,
            syntax,
            config_dir,
            data_dir,
            sink_for,
            owner,
            runtime,
            projects: RwLock::default(),
            requests: Mutex::default(),
        }
    }

    /// The tree-sitter grammars (blocks only if start-up warm-up is still running).
    pub fn syntax(&self) -> Arc<Syntax> {
        self.syntax.get_or_init(|| Arc::new(Syntax::new())).clone()
    }

    /// Every open project (all windows).
    pub fn projects(&self) -> Vec<Arc<Project>> {
        self.projects.read().values().cloned().collect()
    }

    /// The project of `window` (or of the window owning it).
    pub fn project(&self, window: &str) -> IdeResult<Arc<Project>> {
        self.projects
            .read()
            .get((self.owner)(window))
            .cloned()
            .ok_or_else(|| IdeError::not_found("no project is open in this window"))
    }

    /// The window that owns what `window` starts.
    pub fn owner_window<'a>(&self, window: &'a str) -> &'a str {
        (self.owner)(window)
    }

    /// Event sink for things `window` starts (debug sessions, runs, terminals): its
    /// project's window-scoped sink, or a sink for that window when no project is open.
    pub fn window_sink(&self, window: &str) -> SharedSink {
        match self.project(window) {
            Ok(p) => p.sink.clone(),
            Err(_) => (self.sink_for)((self.owner)(window)),
        }
    }

    pub fn close_project(&self, window: &str) {
        let project = self.projects.write().remove(window);
        if let Some(project) = project {
            project.agents.shutdown();
            project.notebooks.stop_admission();
            self.shutdown_notebooks_blocking(vec![project.notebooks.clone()]);
            let lsp = project.lsp.clone();
            self.runtime.spawn(async move { lsp.shutdown_all().await });
        }
    }

    /// Synchronous project/window destruction must finish owned kernel cleanup,
    /// not enqueue work which can be lost as the desktop runtime exits.
    fn shutdown_notebooks_blocking(&self, notebooks: Vec<Arc<notebook::NotebookService>>) {
        for service in &notebooks {
            service.stop_admission();
        }
        let runtime = self.runtime.clone();
        let wait = move || {
            let worker = std::thread::spawn(move || {
                runtime.block_on(async move {
                    for service in notebooks {
                        service.shutdown().await;
                    }
                });
            });
            if let Err(error) = worker.join() {
                tracing::error!("notebook shutdown thread failed: {error:?}");
            }
        };
        if tokio::runtime::Handle::try_current()
            .is_ok_and(|handle| handle.runtime_flavor() == tokio::runtime::RuntimeFlavor::MultiThread)
        {
            tokio::task::block_in_place(wait);
        } else {
            wait();
        }
    }

    /// Called before the desktop runtime exits, including update/restart exits.
    pub fn shutdown_notebooks_on_exit(&self) {
        self.shutdown_notebooks_blocking(self.projects().iter().map(|project| project.notebooks.clone()).collect());
    }

    /// Stops what this host started: notebook kernels, language servers, agents, runs and terminals.
    /// For a process that exits without dropping the host (the remote server).
    pub async fn shutdown(&self) {
        self.processes.kill_all();
        self.terminals.kill_all();
        let projects: Vec<_> = self.projects.write().drain().map(|(_, p)| p).collect();
        for project in &projects {
            project.notebooks.stop_admission();
            project.agents.shutdown();
        }
        // Kernel cleanup owns its interrupt/termination/reaping deadlines. An
        // outer LSP timeout must never abort it before owned children are reaped.
        for project in &projects {
            project.notebooks.shutdown().await;
        }
        let stop_language_servers = async {
            for project in &projects {
                project.lsp.shutdown_all().await;
            }
        };
        if tokio::time::timeout(std::time::Duration::from_secs(10), stop_language_servers).await.is_err() {
            tracing::warn!("language servers did not shut down in time");
        }
    }

    // ---- cancellable requests: the UI allocates ids, `cancel_request` cancels ----

    pub fn begin_request(&self, id: RequestId) -> CancellationToken {
        let token = CancellationToken::new();
        if let Some(old) = self.requests.lock().insert(id, token.clone()) {
            old.cancel();
        }
        token
    }

    pub fn end_request(&self, id: RequestId) {
        self.requests.lock().remove(&id);
    }

    pub fn cancel_request(&self, id: RequestId) {
        if let Some(token) = self.requests.lock().remove(&id) {
            token.cancel();
        }
    }

    pub(crate) fn insert_project(&self, window: &str, project: Arc<Project>) {
        self.projects.write().insert(window.to_owned(), project);
    }
}
