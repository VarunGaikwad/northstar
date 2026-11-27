export type FavLinkResponse = {
  id: string;
  title: string;
  url: string;
  folderId: string | null;
  isPinned: boolean;
  createdAt: Date;
  updatedAt: Date;
};
