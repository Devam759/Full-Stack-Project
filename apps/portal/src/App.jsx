import React from 'react';
import { ShieldAlert, Users, Scale, Settings } from 'lucide-react';

export function App() {
  return (
    <div className="min-h-screen flex flex-col bg-slate-100 text-slate-900">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center text-white font-bold text-sm">
            BL
          </div>
          <div>
            <h1 className="font-bold text-base text-slate-900">BorrowLoop Operations Portal</h1>
            <p className="text-xs text-slate-500">Customer Care & Administration</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
            Care Agent / Admin
          </span>
        </div>
      </header>

      <div className="flex-1 max-w-7xl w-full mx-auto p-6 grid grid-cols-1 md:grid-cols-4 gap-6">
        <aside className="bg-white rounded-lg p-4 border border-slate-200 shadow-sm space-y-2">
          <button
            type="button"
            className="w-full flex items-center gap-3 px-3 py-2 rounded text-sm font-medium text-teal-700 bg-teal-50"
          >
            <Scale className="w-4 h-4" />
            <span>Disputes Queue</span>
          </button>
          <button
            type="button"
            className="w-full flex items-center gap-3 px-3 py-2 rounded text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            <ShieldAlert className="w-4 h-4" />
            <span>Reports</span>
          </button>
          <button
            type="button"
            className="w-full flex items-center gap-3 px-3 py-2 rounded text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            <Users className="w-4 h-4" />
            <span>User Lookup</span>
          </button>
          <button
            type="button"
            className="w-full flex items-center gap-3 px-3 py-2 rounded text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            <Settings className="w-4 h-4" />
            <span>Admin Settings</span>
          </button>
        </aside>

        <main className="md:col-span-3 bg-white rounded-lg p-6 border border-slate-200 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900 mb-2">Operations Dashboard</h2>
          <p className="text-sm text-slate-600">
            Care portal initialized for Phase 0. Case management and decision tools will be active
            upon completion of Phase 8.
          </p>
        </main>
      </div>
    </div>
  );
}

export default App;
