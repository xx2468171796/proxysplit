// 升级（含强制自动更新）后第一次打开：先告诉用户这次更新了什么。内容来自打进程序的 CHANGELOG.md。
// 赞赏码弹窗等这里关掉后再出（updateNotes.settled）。
import { Button, Dialog, DialogFooter } from "@ankotti/admin-ui";
import { useEffect } from "react";
import { api, type ReleaseNote } from "../api/backend";
import { createStore, useStore } from "../shared/store";

/** settled = 已查过且没有要显示的（或已关掉）。 */
export const updateNotes = createStore<{ notes: ReleaseNote[]; settled: boolean }>({ notes: [], settled: false });

export function UpdateNotesDialog() {
  const notes = useStore(updateNotes, (s) => s.notes);

  useEffect(() => {
    api.updateNotes().then(
      (list) => updateNotes.set({ notes: list, settled: list.length === 0 }),
      () => updateNotes.set({ settled: true }),
    );
  }, []);

  if (notes.length === 0) return null;
  const close = () => {
    updateNotes.set({ notes: [], settled: true });
    void api.markUpdateNotesSeen();
  };
  return (
    <Dialog
      open
      size="md"
      title={`已更新到 v${notes[0]?.version ?? ""}`}
      description="本次更新内容"
      onClose={close}
      footer={
        <DialogFooter>
          <Button onClick={close}>知道了</Button>
        </DialogFooter>
      }
    >
      {notes.map((n) => (
        <section key={n.version} className="ps-update-notes">
          {notes.length > 1 ? <h4>v{n.version}</h4> : null}
          <ul>
            {n.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
    </Dialog>
  );
}
