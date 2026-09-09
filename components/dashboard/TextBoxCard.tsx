import { Lightbulb } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type TextBoxCardProps = {
  title: string;
  content: string;
};

export function TextBoxCard({ title, content }: TextBoxCardProps) {
  return (
    <Card className="min-w-0 border-slate-200/80 shadow-none transition hover:border-primary/25 hover:shadow-md">
      <CardHeader className="border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Lightbulb className="h-4 w-4" />
          </div>
          <CardTitle>{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="p-5">
        <p className="whitespace-pre-line text-sm leading-7 text-muted-foreground">{content}</p>
      </CardContent>
    </Card>
  );
}
