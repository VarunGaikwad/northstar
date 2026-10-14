import { Modal } from "./Modal";
import { Button } from "./ui";

interface ConfirmDialogProps {
  open: boolean;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  message,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Modal open={open} title="Are you sure?" onClose={onCancel}>
      <p className="text-sm text-white/80 mb-6 leading-relaxed">{message}</p>
      <div className="flex justify-end gap-3">
        <Button variant="ghost" size="md" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="danger" size="md" onClick={onConfirm}>
          Delete
        </Button>
      </div>
    </Modal>
  );
}
