import { useState, useEffect } from 'react';
import { Button, IconButton } from './Button';

interface ConfirmButtonProps {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  children: React.ReactNode;
  // With text the trigger is a labelled button, otherwise an icon button
  text?: string;
}

// A destructive action that asks again in place instead of opening a dialog or a toast
export default function ConfirmButton({ label, confirmLabel, onConfirm, children, text }: ConfirmButtonProps) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  if (armed) {
    return (
      <Button
        variant="danger"
        className="bg-red-500/10"
        onClick={(e) => { e.stopPropagation(); setArmed(false); onConfirm(); }}
        onBlur={() => setArmed(false)}
        autoFocus
      >
        {confirmLabel}
      </Button>
    );
  }
  if (text) {
    return (
      <Button variant="ghost" className="hover:text-red-500" title={label} onClick={() => setArmed(true)}>
        {children}
        {text}
      </Button>
    );
  }
  return (
    <IconButton label={label} className="hover:text-red-500" onClick={(e) => { e.stopPropagation(); setArmed(true); }}>
      {children}
    </IconButton>
  );
}
