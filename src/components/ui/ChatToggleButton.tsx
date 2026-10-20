import { Sparkles } from 'lucide-react';
import { useNoteStore } from '../../store/noteStore';
import { Button } from './Button';

// The one control that opens the chat, so every view's header offers it the same way
export default function ChatToggleButton() {
  const open = useNoteStore((s) => s.rightSidebarOpen);
  const setOpen = useNoteStore((s) => s.setRightSidebarOpen);
  return (
    <Button
      variant={open ? 'secondary' : 'primary'}
      onClick={() => setOpen(!open)}
      title={open ? 'Close chat' : 'Open chat'}
      aria-pressed={open}
    >
      <Sparkles className="w-3.5 h-3.5" />
      Chat
    </Button>
  );
}
