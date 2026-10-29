<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="src-tauri/icons/source/openidea-wordmark-dark.svg">
    <img src="src-tauri/icons/source/openidea-wordmark.svg" alt="OpenIDEA" height="56">
  </picture>
</p>

<p align="center">
  The IDE you know, rebuilt in Rust.
</p>

<p align="center">
  <a href="https://github.com/l0ng-ai/openidea/releases/latest"><b>Download</b></a>
  &nbsp;·&nbsp;
  <a href="#benchmark">Benchmark</a>
  &nbsp;·&nbsp;
  <a href="#build">Build</a>
</p>

https://github.com/user-attachments/assets/234dd54c-1255-4b3a-b35c-533d78d737c0

OpenIDEA brings the IntelliJ IDEA way of working — its keymap, its tool windows,
its search-everything habits — to a native app with a Rust core.

Editor, code insight, debugger, Git, terminal, database and HTTP clients,
for 60+ languages. Builds for macOS, Windows and Linux.

## Benchmark

Opening [freqtrade](https://github.com/freqtrade/freqtrade) (Python, ~770 files)
with warm caches, median of 5 runs:

|                             | OpenIDEA          | IntelliJ IDEA 2026.2.3 |
| --------------------------- | ----------------- | ---------------------- |
| Window with the project     | **0.9 s**         | 3.1 s                  |
| Ready (CPU settled)         | **1.1 s**         | 13.2 s                 |
| Memory (USS, all processes) | **169 MB**        | 2011 MB                |
| CPU time until ready        | **2.4 s**         | 47.9 s                 |
| Idle CPU                    | **4 %** of a core | 7 % of a core          |
| Quit                        | **0.3 s**         | 5.9 s                  |

A release build of OpenIDEA from `main` and IDEA with default settings and plugins, on
Windows 11, 32-core AMD, 62 GB RAM.
IDEA analyses Python more deeply, so "ready" doesn't mean the same work on
both sides. Both are measured from the outside, the same way: see
[`perf/compare`](perf/compare) to run it on your machine and projects.

## Jupyter notebooks

Open `.ipynb` files directly in LightEdit or from a project. Python and Markdown
cells are editable in a virtualized cell list; raw and unknown cells are displayed
read-only and preserved on save.

Run Python code with **Run Cell** or **Run All**, choose a Python interpreter, and
interrupt or restart the notebook's persistent local kernel from the toolbar. The selected environment
needs `ipykernel` (`python -m pip install ipykernel`); no Jupyter server is required.
Opening or saving a notebook never runs its cells.
With a Python code cell focused, **Shift+Enter** runs that cell.

Save, undo/redo, split editors and unsaved-change prompts share one notebook document.
Split views share a kernel; closing its last view or switching projects stops it.
An unchanged notebook saves byte-for-byte, including its original formatting and
unknown fields; external file changes are reported rather than overwritten.
Text, tracebacks, PNG/JPEG images and sanitized SVG render inline. HTML is sanitized
and shown in a static sandboxed iframe. JavaScript outputs are displayed as inert
source in that sandbox, not executed; the IDE-wide Content Security Policy is not
relaxed for notebook outputs.

Script-dependent interactive outputs (such as widgets or interactive Plotly/Bokeh
charts) are not supported. Remote Jupyter connections, a variable explorer,
notebook language-server features and cell debugging are also not supported.

## Build

```sh
pnpm install
pnpm tauri dev
```

Rust 1.96, Node 22, pnpm and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

Native notebook execution tests are opt-in and need two distinct Python environments
with `ipykernel` installed:

```sh
OPENIDEA_TEST_PYTHON=/first/env/bin/python \
OPENIDEA_TEST_PYTHON_SECOND=/second/env/bin/python \
cargo test -p ide-notebook --test kernel_runtime -- --ignored --test-threads=1
```

## License

[Apache 2.0](LICENSE). Bundled third-party assets are listed in [`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md).

<sub>Not affiliated with JetBrains. IntelliJ IDEA is a trademark of JetBrains s.r.o.</sub>
