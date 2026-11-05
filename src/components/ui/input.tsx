"use client";

import type { ComponentType, ReactNode, Ref } from "react";
import {
  FieldError as AriaFieldError,
  Group as AriaGroup,
  Input as AriaInput,
  Label as AriaLabel,
  Text as AriaText,
  TextField as AriaTextField,
  type TextFieldProps as AriaTextFieldProps,
} from "react-aria-components";
import { cx } from "@/lib/utils";

/*
 * Input — adapted from BoardUI's Input (MIT, https://www.boardui.com/components/input).
 * React Aria TextField: label ↔ input ↔ hint/error wiring, aria-invalid / aria-required.
 * Visual: filled field + inset ring on hover/focus, restyled with RandevuN tokens. The `name` prop
 * lands on the native <input>, so server-action forms keep working unchanged. 17px text so iOS
 * Safari does not zoom on focus.
 */

type IconComponent = ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;

export const fieldShellClassName = ({
  isFocusWithin = false,
  isHovered = false,
  isDisabled = false,
  isInvalid = false,
}: {
  isFocusWithin?: boolean;
  isHovered?: boolean;
  isDisabled?: boolean;
  isInvalid?: boolean;
}) =>
  cx(
    "tap-target relative flex w-full items-center gap-2 rounded-control border border-field-border bg-surface-muted px-3.5 text-ink-muted",
    "transition-[background-color,box-shadow,border-color] duration-150",
    isHovered && !isFocusWithin && !isDisabled && !isInvalid && "bg-surface",
    isFocusWithin && !isDisabled && "bg-surface outline-2 outline-offset-2 outline-focus",
    isDisabled && "cursor-not-allowed opacity-60",
    isInvalid && "border-destructive bg-status-rejected-bg text-destructive",
  );

export interface InputProps extends Omit<AriaTextFieldProps, "className" | "children"> {
  label?: ReactNode;
  hint?: ReactNode;
  errorMessage?: ReactNode;
  placeholder?: string;
  leadingIcon?: IconComponent;
  trailingIcon?: IconComponent;
  className?: string;
  inputClassName?: string;
  ref?: Ref<HTMLInputElement>;
}

export function Input({
  label,
  hint,
  errorMessage,
  placeholder,
  leadingIcon: Leading,
  trailingIcon: Trailing,
  className,
  inputClassName,
  ref,
  ...props
}: InputProps) {
  const ltr = ["email", "url", "tel"].includes(props.type ?? "");
  return (
    <AriaTextField
      {...props}
      className={cx("group flex w-full flex-col gap-1.5", className)}
      aria-label={props["aria-label"] ?? (!label ? placeholder : undefined)}
    >
      {({ isRequired, isInvalid }) => (
        <>
          {label ? (
            <AriaLabel className="flex items-center gap-0.5 text-subhead font-medium text-ink">
              {label}
              {isRequired ? (
                <span aria-hidden="true" className="text-destructive">
                  *
                </span>
              ) : null}
            </AriaLabel>
          ) : null}
          <AriaGroup className={(state) => fieldShellClassName(state)}>
            {Leading ? <Leading className="size-5 shrink-0" aria-hidden /> : null}
            <AriaInput
              ref={ref}
              placeholder={placeholder}
              dir={ltr ? "ltr" : undefined}
              className={cx(
                "min-w-0 flex-1 border-0 bg-transparent py-2.5 text-body text-ink outline-none placeholder:text-ink-muted disabled:cursor-not-allowed",
                inputClassName,
              )}
            />
            {Trailing ? <Trailing className="size-5 shrink-0" aria-hidden /> : null}
          </AriaGroup>
          {isInvalid && errorMessage != null ? (
            <AriaFieldError className="text-footnote font-medium text-destructive">{errorMessage}</AriaFieldError>
          ) : hint ? (
            <AriaText slot="description" className="text-footnote text-ink-muted">
              {hint}
            </AriaText>
          ) : null}
        </>
      )}
    </AriaTextField>
  );
}
