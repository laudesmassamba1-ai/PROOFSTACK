import type React from "react";

export const Button: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" }
> = ({ children, className = "", variant = "primary", ...rest }) => {
  const cls = ["btn", variant === "primary" ? "btn-primary" : "btn-ghost", className]
    .filter(Boolean)
    .join(" ");
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
};
