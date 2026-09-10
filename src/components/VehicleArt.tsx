export function VehicleArt({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 240 120"
      role="img"
      aria-label="Side profile line drawing of a classic coupe"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M22 76h14l10-25 35-17h65l34 23 28 7 10 12v14h-18" />
      <path d="M58 51h112M89 35 74 57m42-22v22m30-22 21 22M38 76h166" />
      <path d="M76 91H55m132 0h-73" />
      <circle cx="94" cy="88" r="20" />
      <circle cx="94" cy="88" r="10" />
      <circle cx="184" cy="88" r="20" />
      <circle cx="184" cy="88" r="10" />
      <path d="M28 67h18m158 1h11M125 65h18m-13-4v8" />
    </svg>
  );
}
