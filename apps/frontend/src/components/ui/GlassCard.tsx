import React from "react";

export interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "hoverable" | "subtle" | "glow";
  padding?: "none" | "sm" | "md" | "lg";
}

export const GlassCard: React.FC<GlassCardProps> = ({
  children,
  variant = "default",
  padding = "md",
  className = "",
  ...props
}) => {
  const paddingClasses = {
    none: "",
    sm: "p-3",
    md: "p-5",
    lg: "p-6 sm:p-8",
  };

  const variantClasses = {
    default:
      "bg-gradient-to-b from-white/[0.08] to-white/[0.03] border border-white/15 backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.08)]",
    hoverable:
      "bg-white/[0.06] border border-white/10 hover:bg-white/[0.12] hover:border-white/20 hover:-translate-y-0.5 backdrop-blur-xl transition-all duration-200 cursor-pointer shadow-md hover:shadow-xl hover:shadow-indigo-500/10",
    subtle:
      "bg-slate-900/40 border border-white/10 backdrop-blur-md",
    glow:
      "bg-gradient-to-b from-indigo-500/10 to-violet-500/5 border border-indigo-400/30 backdrop-blur-xl shadow-[0_0_24px_rgba(129,140,248,0.2)]",
  };

  return (
    <div
      className={`rounded-2xl text-white ${variantClasses[variant]} ${paddingClasses[padding]} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};
