import React from "react";

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  label: string; // Accessibility label
  variant?: "ghost" | "glass" | "danger" | "primary";
  size?: "sm" | "md" | "lg";
}

export const IconButton: React.FC<IconButtonProps> = ({
  icon,
  label,
  variant = "ghost",
  size = "md",
  className = "",
  ...props
}) => {
  const variantClasses = {
    ghost: "text-white/70 hover:text-white hover:bg-white/10 border border-transparent",
    glass: "bg-white/10 text-white/90 hover:text-white hover:bg-white/20 border border-white/15 backdrop-blur-md shadow-sm",
    danger: "text-red-400 hover:text-red-300 hover:bg-red-500/20 border border-transparent",
    primary: "bg-indigo-500 text-white hover:bg-indigo-400 border border-white/10 shadow-md shadow-indigo-500/20",
  };

  const sizeClasses = {
    sm: "w-7 h-7 text-xs rounded-lg",
    md: "w-9 h-9 text-sm rounded-xl",
    lg: "w-11 h-11 text-base rounded-2xl",
  };

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 active:scale-95 disabled:opacity-50 disabled:pointer-events-none ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {icon}
    </button>
  );
};
