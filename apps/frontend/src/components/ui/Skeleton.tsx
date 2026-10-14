import React from "react";

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "text" | "circular" | "rectangular";
  width?: string | number;
  height?: string | number;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  variant = "text",
  width,
  height,
  className = "",
  style,
  ...props
}) => {
  const variantClasses = {
    text: "h-4 rounded-md w-full",
    circular: "rounded-full shrink-0",
    rectangular: "rounded-xl w-full",
  };

  return (
    <div
      className={`animate-shimmer rounded-xl ${variantClasses[variant]} ${className}`}
      style={{
        width,
        height,
        ...style,
      }}
      {...props}
    />
  );
};
