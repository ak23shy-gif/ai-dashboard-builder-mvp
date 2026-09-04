import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type DataTableProps = {
  title: string;
  rows: Array<Record<string, string | number>>;
  columns: Array<{ key: string; label: string }>;
};

export function DataTable({ title, rows, columns }: DataTableProps) {
  return (
    <Card className="min-w-0 overflow-hidden border-slate-200/80 shadow-none transition hover:border-primary/25 hover:shadow-md">
      <CardHeader className="border-b border-slate-100 pb-3">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="max-h-[360px] overflow-auto rounded-md border border-slate-100">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50">
              <tr className="border-b border-border text-left text-xs uppercase text-slate-500">
                {columns.map((column) => (
                  <th className="whitespace-nowrap px-3 py-2.5 font-semibold" key={column.key}>{column.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr className="border-b border-slate-100 transition hover:bg-slate-50 last:border-0" key={index}>
                  {columns.map((column) => (
                    <td className="whitespace-nowrap px-3 py-3 text-slate-700" key={column.key}>{row[column.key]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
