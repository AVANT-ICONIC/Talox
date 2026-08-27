from pathlib import Path

path = Path("src/core/controller/TaloxController.ts")
text = path.read_text()


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one anchor, found {count}")
    text = text.replace(old, new, 1)


replace_once(
    '''\tprivate getAttentionFrameForActivePage(): AttentionFrame | null {
\t\tconst activePage = this._session.getActivePage();
\t\tif (!activePage) return this.pendingAttentionFrame;
\t\treturn this.pageAttentionFrames.get(activePage) ?? null;
\t}

\tprivate setAttentionFrameForActivePage(frame: AttentionFrame | null): void {
\t\tconst activePage = this._session.getActivePage();
\t\tif (!activePage) {
\t\t\tthis.pendingAttentionFrame = frame;
\t\t\treturn;
\t\t}
\t\tif (frame) this.pageAttentionFrames.set(activePage, frame);
\t\telse this.pageAttentionFrames.delete(activePage);
\t}

\tprivate bindPendingAttentionFrameToActivePage(): void {
\t\tif (!this.pendingAttentionFrame) return;
\t\tconst activePage = this._session.getActivePage();
\t\tif (!activePage) return;
\t\tthis.pageAttentionFrames.set(activePage, this.pendingAttentionFrame);
\t\tthis.pendingAttentionFrame = null;
\t}
''',
    '''\tprivate getActiveAttentionFrameOwner(): PageStateCollector | null {
\t\tconst activePage = this._session.getActivePage();
\t\tif (!activePage || activePage.getPage().isClosed()) return null;
\t\treturn activePage;
\t}

\tprivate getAttentionFrameForActivePage(): AttentionFrame | null {
\t\tconst activePage = this.getActiveAttentionFrameOwner();
\t\tif (!activePage) return this.pendingAttentionFrame;
\t\treturn this.pageAttentionFrames.get(activePage) ?? null;
\t}

\tprivate setAttentionFrameForActivePage(frame: AttentionFrame | null): void {
\t\tconst activePage = this.getActiveAttentionFrameOwner();
\t\tif (!activePage) {
\t\t\tthis.pendingAttentionFrame = frame;
\t\t\treturn;
\t\t}
\t\tif (frame) this.pageAttentionFrames.set(activePage, frame);
\t\telse this.pageAttentionFrames.delete(activePage);
\t}

\tprivate bindPendingAttentionFrameToActivePage(): void {
\t\tif (!this.pendingAttentionFrame) return;
\t\tconst activePage = this.getActiveAttentionFrameOwner();
\t\tif (!activePage) return;
\t\tthis.pageAttentionFrames.set(activePage, this.pendingAttentionFrame);
\t\tthis.pendingAttentionFrame = null;
\t}
''',
    "attention owner helpers",
)

replace_once(
    '''\t\ttry {
\t\t\tawait this._session.stop();
\t\t} catch (e) {
''',
    '''\t\tthis.pendingAttentionFrame = this.getAttentionFrame();
\t\ttry {
\t\t\tawait this._session.stop();
\t\t} catch (e) {
''',
    "stop pending snapshot",
)

path.write_text(text)
