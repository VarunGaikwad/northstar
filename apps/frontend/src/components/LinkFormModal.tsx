import { useState } from "react";
import type { FavLink } from "../types";
import { Modal } from "./Modal";
import { Button, Input } from "./ui";
import { Globe, Tag } from "lucide-react";

interface LinkFormModalProps {
  open: boolean;
  link: FavLink | null;
  onClose: () => void;
  onSave: (title: string, url: string) => void;
  isSaving?: boolean;
  error?: string | null;
}

export function LinkFormModal(props: LinkFormModalProps) {
  return <LinkFormInner key={`${props.open}-${props.link?.id ?? "new"}`} {...props} />;
}

function LinkFormInner({ open, link, onClose, onSave, isSaving = false, error }: LinkFormModalProps) {
  const [title, setTitle] = useState(link?.title ?? "");
  const [url, setUrl] = useState(link?.url ?? "");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    let cleanUrl = url.trim();
    const cleanTitle = title.trim();
    if (!cleanTitle || !cleanUrl) return;
    if (!/^https?:\/\//i.test(cleanUrl)) cleanUrl = "https://" + cleanUrl;
    onSave(cleanTitle, cleanUrl);
  };

  return (
    <Modal open={open} title={link ? "Edit Bookmark" : "Add Bookmark"} onClose={onClose} dismissible={!isSaving}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label="Name"
          placeholder="e.g. GitHub"
          value={title}
          disabled={isSaving}
          onChange={(e) => setTitle(e.target.value)}
          leftIcon={<Tag className="w-4 h-4" />}
          required
          autoFocus
        />
        <Input
          label="URL"
          placeholder="https://github.com"
          value={url}
          disabled={isSaving}
          onChange={(e) => setUrl(e.target.value)}
          leftIcon={<Globe className="w-4 h-4" />}
          required
        />
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        <div className="flex justify-end gap-3 mt-2">
          <Button type="button" variant="ghost" size="md" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="md" isLoading={isSaving}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}
