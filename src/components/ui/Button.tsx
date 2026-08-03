import type { ButtonHTMLAttributes, ReactNode } from "react";
import "../../buttons.css";

type Variant = "primary" | "ghost" | "secondary" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  pill?: boolean;
  wide?: boolean;
  children?: ReactNode;
}

const VARIANT_CLASS: Record<Variant, string> = {
  primary: "btnPrimary",
  ghost: "btnGhost",
  secondary: "btnGhost",
  danger: "btnDanger",
};

/**
 * Wrapper mince autour des classes globales .btn* déjà en production
 * (App.css). N'introduit pas de nouveau style visuel : centralise
 * juste la composition des classes pour éviter les répétitions
 * `className="btn btnPrimary ..."` dispersées dans chaque page.
 */
export default function Button({
  variant = "secondary",
  pill = false,
  wide = false,
  className = "",
  children,
  ...rest
}: ButtonProps) {
  const classes = [
    "btn",
    VARIANT_CLASS[variant],
    pill ? "btnPill" : "",
    wide ? "btnWide" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button className={classes} {...rest}>
      {children}
    </button>
  );
}
