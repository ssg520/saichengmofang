import { useEffect } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { HomePage } from '@/pages/HomePage';
import { WizardPage } from '@/pages/WizardPage';
import { EditorPage } from '@/pages/EditorPage';
import { SharePage } from '@/pages/SharePage';
import { useStore } from '@/store/tournament';

export default function App() {
  const checkCloud = useStore((s) => s.checkCloud);
  useEffect(() => {
    void checkCloud();
  }, [checkCloud]);

  return (
    <TooltipProvider delayDuration={200}>
      <BrowserRouter>
        <div className="h-full">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/new" element={<WizardPage />} />
            <Route path="/t/:id" element={<EditorPage />} />
            <Route path="/s/:shareId" element={<SharePage />} />
            <Route path="*" element={<HomePage />} />
          </Routes>
        </div>
      </BrowserRouter>
      <Toaster theme="dark" richColors position="top-center" />
    </TooltipProvider>
  );
}