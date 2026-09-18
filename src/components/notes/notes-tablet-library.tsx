import type { ReactNode } from 'react';

import { AdaptivePanes } from '@/components/ui/adaptive-panes';

interface NotesTabletLibraryProps {
  library: ReactNode;
  prompt: ReactNode;
}

/** Keeps reorder/scroll ownership in the library while reserving a readable second pane. */
export function NotesTabletLibrary({ library, prompt }: NotesTabletLibraryProps) {
  return (
    <AdaptivePanes
      testID="notes-tablet-library"
      main={library}
      support={prompt}
      variant="library-reading"
      singlePane="main-only"
      fill
    />
  );
}
