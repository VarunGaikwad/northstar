import { useState } from "react";
import { Modal } from "./Modal";
import { Button, Input } from "./ui";
import { Folder } from "lucide-react";

interface FolderFormModalProps {
  open: boolean;
  initialName: string | null;
  onClose: () => void;
  onSave: (name: string) => void;
}

export function FolderFormModal(props: FolderFormModalProps) {
  return (
    <FolderFormInner
      key={`${props.open}-${props.initialName ?? "new"}`}
      {...props}
    />
  );
}

function FolderFormInner({
  open,
  initialName,
  onClose,
  onSave,
}: FolderFormModalProps) {
  const [name, setName] = useState(initialName ?? "");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) return;
    onSave(clean);
  };

  return (
    <Modal
      open={open}
      title={initialName !== null ? "Rename Folder" : "New Folder"}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label="Folder name"
          placeholder="e.g. Work, Tools, Reading"
          value={name}
          onChange={(e) => setName(e.target.value)}
          leftIcon={<Folder className="w-4 h-4" />}
          required
          autoFocus
        />
        <div className="flex justify-end gap-3 mt-2">
          <Button type="button" variant="ghost" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="md">
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}
