import { useUnsplash } from "../hooks/useUnsplash";

export function BackgroundImage() {
  const { photo, isLoading } = useUnsplash();
  const showFallback = !photo || (isLoading && !localStorage.getItem("dashboard.unsplashPhoto"));

  return (
    <div className="fixed inset-0 -z-10">
      {photo && (
        <img
          src={photo.url}
          alt=""
          className="absolute inset-0 w-full h-full object-cover fade-in"
        />
      )}
      {showFallback && (
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-950" />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/10 to-black/70" />
      {photo && (
        <div className="absolute bottom-4 right-4 text-xs text-white/40 z-10">
          Photo by{" "}
          <a
            href={photo.photographerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-white/60"
          >
            {photo.photographer}
          </a>{" "}
          on Unsplash
        </div>
      )}
    </div>
  );
}
