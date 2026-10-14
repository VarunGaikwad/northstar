import React from "react";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "neutral" | "primary" | "success" | "warning" | "danger";
  size?: "sm" | "md";
  dot?: boolean;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = "neutral",
  size = "md",
  dot = false,
  className = "",
  ...props
}) => {
  const variantClasses = {
    neutral: "bg-white/10 text-white/90 border border-white/15",
    primary: "bg-indigo-500/20 text-indigo-300 border border-indigo-400/30",
    success: "bg-emerald-500/20 text-emerald-300 border border-emerald-400/30",
    warning: "bg-amber-500/20 text-amber-300 border border-amber-400/30",
    danger: "bg-red-500/20 text-red-300 border border-red-400/30",
  };

  const dotColorClasses = {
    neutral: "bg-white/60",
    primary: "bg-indigo-400",
    success: "bg-emerald-400 animate-pulse-glow",
    warning: "bg-amber-400",
    danger: "bg-red-400",
  };

  const sizeClasses = {
    sm: "px-2 py-0.5 text-[11px] font-medium rounded-full gap-1",
    md: "px-2.5 py-1 text-xs font-semibold rounded-full gap-1.5",
  };

  return (
    <span
      className={`inline-flex items-center backdrop-blur-md transition-colors ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColorClasses[variant]}`} />}
      {children}
    </span>
  );
};
