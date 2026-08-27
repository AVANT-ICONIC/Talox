from pathlib import Path

path = Path("src/core/controller/TaloxController.ts")
text = path.read_text()
old = "\t\t\tthis.attentionFrame,\n"
new = "\t\t\tthis.getAttentionFrame(),\n"
count = text.count(old)
if count != 1:
    raise SystemExit(f"expected exactly one legacy attentionFrame reference, found {count}")
path.write_text(text.replace(old, new, 1))
