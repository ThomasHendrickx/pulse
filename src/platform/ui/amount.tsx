// THE one way a monetary amount is rendered (pulse-frontend section 4):
// mono, tabular-nums, slashed-zero, right aligned, via the .pulse-amount
// token class. Belgian locale: thousands ".", decimals ",". Amounts arrive
// as integer cents and are converted to a display string HERE and nowhere
// else; the integer and fraction halves are formatted separately so no
// float touches the digits.

const integerFormatter = new Intl.NumberFormat("nl-BE", {
  maximumFractionDigits: 0,
});

export const formatCents = (cents: number): string => {
  if (!Number.isInteger(cents)) {
    throw new Error(`Amount must be integer cents, got ${cents}`);
  }
  const sign = cents < 0 ? "-" : "";
  const magnitude = Math.abs(cents);
  const euros = Math.trunc(magnitude / 100);
  const fraction = String(magnitude % 100).padStart(2, "0");
  return `${sign}${integerFormatter.format(euros)},${fraction}`;
};

export const Amount = ({ cents }: { readonly cents: number }) => (
  <span className="pulse-amount">{formatCents(cents)}</span>
);
