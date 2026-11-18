export function OrbitMark({ className = "" }: { className?: string }) {
  return (
    <span className={`orbit-mark ${className}`} aria-hidden="true">
      <i /><i /><i />
    </span>
  );
}
