export type PhotographerCredit = {
  name: string;
  username: string;
  profileUrl: string;
};

export type BackgroundImage = {
  url: string;
  alt: string | null;
  unsplashUrl: string;
  photographer: PhotographerCredit;
};

export type BackgroundResponse = {
  image: BackgroundImage;
};
