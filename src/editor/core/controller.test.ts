import { afterEach, describe, expect, it } from "vitest";
import { EditorController, openFilePaths, useEditorStatus, useTabs } from "./controller";
import { createMemoryBackend } from "./backend";
import { initialTabsState } from "./model/tabs";
import { resetDistractionFree, setDistractionFree } from "@/workbench/distractionFree";
import { registerActions } from "@/platform/actions";
import { useProject } from "@/platform/project";
import { resolveMenuItems } from "@/ui";

let ctrl: EditorController | null = null;

afterEach(() => {
  ctrl?.stop();
  ctrl = null;
  useTabs.setState(initialTabsState(), true);
  useEditorStatus.setState({ status: null });
});

describe("EditorController", () => {
  it("updates the caret status synchronously on programmatic selection changes", async () => {
    ctrl = new EditorController(createMemoryBackend({ "/p/a.ts": "one\ntwo\nthree\n" }));
    ctrl.start();
    await ctrl.openFile("/p/a.ts", { focus: false });
    const s = useTabs.getState();
    const slot = ctrl.slotFor(s.panes[s.activePane]!.active!)!;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = slot.mount(host);
    ctrl.onMounted(slot);
    view.dispatch({ selection: { anchor: 6 } });
    expect(useEditorStatus.getState().status).toMatchObject({ path: "/p/a.ts", line: 1, col: 2, offset: 6 });
    view.dispatch({ selection: { anchor: 4, head: 9 } });
    expect(useEditorStatus.getState().status).toMatchObject({ line: 2, col: 1, selectedChars: 5, selectedLines: 1 });
    slot.unmount();
    host.remove();
  });

  it("reconfigures open editors when Distraction Free Mode toggles", async () => {
    ctrl = new EditorController(createMemoryBackend({ "/p/a.ts": "one\ntwo\n" }));
    ctrl.start();
    await ctrl.openFile("/p/a.ts", { focus: false });
    const s = useTabs.getState();
    const slot = ctrl.slotFor(s.panes[s.activePane]!.active!)!;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = slot.mount(host);
    expect(view.dom.querySelector(".cm-lineNumbers")).not.toBeNull();
    setDistractionFree(true);
    expect(view.dom.querySelector(".cm-lineNumbers")).toBeNull();
    expect(view.dom.classList.contains("cm-openidea-distractionFree")).toBe(true);
    setDistractionFree(false);
    expect(view.dom.querySelector(".cm-lineNumbers")).not.toBeNull();
    expect(view.dom.classList.contains("cm-openidea-distractionFree")).toBe(false);
    resetDistractionFree();
    slot.unmount();
    host.remove();
  });

  it("lists open file paths across panes", async () => {
    ctrl = new EditorController(createMemoryBackend());
    ctrl.start();
    await ctrl.openFile("/p/a.ts", { focus: false });
    await ctrl.openFile("/p/b.ts", { focus: false, side: true });
    await ctrl.openFile("/p/a.ts", { focus: false, side: true });
    expect(openFilePaths(useTabs.getState())).toEqual(["/p/a.ts", "/p/b.ts"]);
  });

  it("closes a tab by its input key", async () => {
    ctrl = new EditorController(createMemoryBackend());
    ctrl.start();
    await ctrl.openFile("/p/a.ts", { focus: false });
    await ctrl.openFile("/p/b.ts", { focus: false });
    const key = Object.values(useTabs.getState().panes)
      .flatMap((p) => p.tabs)
      .find((t) => t.input.path === "/p/b.ts")!.input.key;
    await ctrl.closeInput(key);
    expect(openFilePaths(useTabs.getState())).toEqual(["/p/a.ts"]);
  });

  it("builds IDEA's editor tab menu", async () => {
    useProject.setState({
      project: { name: "p", root: "/p", isGit: true, settings: {} } as never,
      settings: {} as never,
    });
    const ids = [
      "navigate.selectIn",
      "project.revealInFinder",
      "vcs.localHistory",
      "vcs.commit",
      "project.copyAbsolutePath",
      "project.rename",
      "file.settings",
    ];
    const dispose = registerActions(ids.map((id) => ({ id, title: id, run: () => undefined })));
    ctrl = new EditorController(createMemoryBackend({ "/p/a.ts": "", "/p/b.ts": "" }));
    ctrl.start();
    await ctrl.openFile("/p/a.ts", { focus: false });
    await ctrl.openFile("/p/b.ts", { focus: false });
    const s = useTabs.getState();
    const pane = s.panes[s.activePane]!;
    const items = resolveMenuItems(ctrl.tabMenu(pane.id, pane.tabs[0]!));
    expect(items.find((i) => i.label === "Close Tabs to the Left")?.disabled).toBe(true);
    expect(items.find((i) => i.label === "Close Tabs to the Right")?.disabled).toBe(false);
    dispose();
    useProject.setState({ project: null, settings: null });
  });
});
