import { Sidebar } from "./Sidebar";
import { AdminGuard } from "../AdminGuard";

export function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminGuard>
      <div className="min-h-screen bg-background">
        <Sidebar />
        <main className="pl-64 h-screen overflow-y-auto">
          <div className="p-8 max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </AdminGuard>
  );
}
