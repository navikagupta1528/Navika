/**
 * Form field errors, wired so assistive technology can actually reach them.
 *
 * THE DEFECT THIS FIXES
 * ---------------------
 * Both auth forms rendered their errors as a bare paragraph sitting under the
 * input:
 *
 *     <input id="email" ... />
 *     {state?.errors?.email?.[0] ? <p className="...">{...}</p> : null}
 *
 * Nothing connected the two. A screen reader user submitted the form, the
 * password was wrong, a red line appeared under the field - and the screen
 * reader said nothing, because from its point of view nothing had changed. Focus
 * stayed wherever it was, the message was not a live region, and the input was
 * not marked invalid. The form looked like it had done nothing at all.
 *
 * That is the one case where a live region matters most: the error exists *only*
 * after the user acts, so there is no prior state for the user to notice it
 * against. `role="alert"` on the form-level message and `aria-describedby` plus
 * `aria-invalid` on the field cover both halves - announced when it appears, and
 * still available when the user navigates back to the field later.
 *
 * `role="alert"` was used nowhere in this app before. That is checkable, and it is
 * why the smoke suite could not assert on any auth message: `errorText` in
 * `scripts/lib/http.ts` reads `role="alert"` because that is where errors were
 * supposed to be, and every auth error was silently invisible to it.
 */

/**
 * The message under an input.
 *
 * Renders nothing when there is no message, rather than an empty paragraph: an
 * element with padding and no content is a visible gap in the layout, and `mt-1`
 * on top of it adds another.
 */
export function FieldError({
  id,
  message,
}: {
  /** Must match the `aria-describedby` on the input it belongs to. */
  id: string;
  message?: string;
}) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 text-xs text-red-600">
      {message}
    </p>
  );
}

/**
 * Build an `aria-describedby` value from the ids that actually exist.
 *
 * Takes the parts and joins only what is present, which matters because the
 * hinted fields (password, the child's enrollment number) have *two* things to
 * describe: the guidance shown before you type, and the error shown after you
 * submit. Hard-coding either one id overwrites the other, so the field ends up
 * announced with only half of what the sighted user can see.
 *
 * Returns undefined rather than an empty string when nothing applies, because
 * `aria-describedby=""` is a reference to a non-existent id - some assistive
 * tech announces the literal empty string, which is worse than saying nothing.
 */
export function describedBy(...ids: (string | undefined | false)[]): string | undefined {
  const present = ids.filter((id): id is string => Boolean(id));
  return present.length > 0 ? present.join(" ") : undefined;
}

/**
 * Hint text under an input, given an id so `aria-describedby` can point at it.
 *
 * Also rendered conditionally for the same reason `FieldError` is: an empty
 * paragraph with `mt-1` still occupies a line.
 */
export function FieldHint({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="mt-1 text-xs text-slate-500">
      {children}
    </p>
  );
}