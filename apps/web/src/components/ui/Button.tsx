import type React from "react";

type ButtonSize = "sm" | "md" | "lg";

export const Button: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "ghost";
    size?: ButtonSize;
  }
> = ({ children, className = "", variant = "primary", size = "md", ...rest }) => {
  const cls = [
    "btn",
    variant === "primary" ? "btn-primary" : "btn-ghost",
    size === "sm" ? "btn-sm" : size === "lg" ? "btn-lg" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
};
