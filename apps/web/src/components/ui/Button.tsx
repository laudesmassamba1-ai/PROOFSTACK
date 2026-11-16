import React from "react";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
};

function classFor(variant: ButtonProps['variant'], size?: ButtonProps['size']): string {
  const base = 'btn';
  const v = variant ?? 'default';
  const sizeClass = size === 'sm' ? '' : size === 'lg' ? '' : '';
  switch (v) {
    case 'primary':
      return `${base} btn-primary`;
    case 'ghost':
      return `${base} btn-ghost`;
    default:
      return base;
  }
}

export const Button: React.FC<ButtonProps> = ({ children, variant, className, ...rest }) => {
  const cls = [classFor(variant, undefined), className].filter(Boolean).join(' ');
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
};

export default Button;
