"""Minimal desktop GUI for roster_generator.build_roster.

Packaged into a standalone Windows .exe (see .github/workflows/build-windows-exe.yml)
so a non-technical user can generate/update the roster without a command line.
"""
from __future__ import annotations

import os
import sys
import traceback
import tkinter as tk
from datetime import date, timedelta
from tkinter import filedialog, messagebox

import roster_generator as rg


def next_monday(today: date | None = None) -> date:
    today = today or date.today()
    days_ahead = (0 - today.weekday()) % 7
    days_ahead = days_ahead or 7
    return today + timedelta(days=days_ahead)


def default_planner_path() -> str:
    # Next to the .exe when frozen by PyInstaller, next to this script otherwise.
    base = os.path.dirname(os.path.abspath(sys.executable if getattr(sys, "frozen", False) else __file__))
    return os.path.join(base, "Roster_Planner.xlsx")


class RosterApp(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("Roster Planner")
        self.geometry("520x420")
        self.resizable(False, False)
        self.configure(bg="#faf7f2")

        self.file_var = tk.StringVar(value=default_planner_path())
        self.start_var = tk.StringVar(value=next_monday().isoformat())
        self.weeks_var = tk.StringVar(value="4")
        self.commit_var = tk.BooleanVar(value=True)

        tk.Label(self, text="Roster Planner", font=("Segoe UI", 18, "bold"),
                 bg="#faf7f2", fg="#c1443a").pack(pady=(18, 2))
        tk.Label(self, text="Generate a fair, rotating weekly staff roster.",
                 bg="#faf7f2", fg="#555").pack()

        form = tk.Frame(self, bg="#faf7f2")
        form.pack(fill="x", padx=20, pady=16)
        form.columnconfigure(0, weight=1)

        tk.Label(form, text="Planner workbook:", bg="#faf7f2", anchor="w").grid(
            row=0, column=0, columnspan=2, sticky="w")
        tk.Entry(form, textvariable=self.file_var, width=46).grid(
            row=1, column=0, sticky="we", pady=(2, 10))
        tk.Button(form, text="Browse...", command=self.browse).grid(row=1, column=1, padx=(8, 0))

        tk.Label(form, text="Start date (must be a Monday, YYYY-MM-DD):", bg="#faf7f2", anchor="w").grid(
            row=2, column=0, columnspan=2, sticky="w")
        tk.Entry(form, textvariable=self.start_var, width=16).grid(row=3, column=0, sticky="w", pady=(2, 10))

        tk.Label(form, text="Number of weeks:", bg="#faf7f2", anchor="w").grid(
            row=4, column=0, columnspan=2, sticky="w")
        tk.Spinbox(form, from_=1, to=52, textvariable=self.weeks_var, width=6).grid(
            row=5, column=0, sticky="w", pady=(2, 10))

        tk.Checkbutton(form, text="Save fairness history (commit)", variable=self.commit_var,
                        bg="#faf7f2").grid(row=6, column=0, columnspan=2, sticky="w")

        tk.Button(self, text="Generate Roster", command=self.generate, bg="#c1443a", fg="white",
                  activebackground="#a83a31", activeforeground="white",
                  font=("Segoe UI", 11, "bold"), relief="flat", padx=18, pady=8).pack(pady=14)

        self.status = tk.Text(self, height=8, width=62, state="disabled", bg="#ffffff",
                               relief="solid", borderwidth=1)
        self.status.pack(padx=20, pady=(0, 16))

    def browse(self) -> None:
        path = filedialog.asksaveasfilename(
            title="Choose planner workbook",
            defaultextension=".xlsx",
            filetypes=[("Excel workbook", "*.xlsx")],
            initialfile=os.path.basename(self.file_var.get()),
            initialdir=os.path.dirname(self.file_var.get()) or ".",
        )
        if path:
            self.file_var.set(path)

    def log(self, text: str) -> None:
        self.status.configure(state="normal")
        self.status.insert("end", text + "\n")
        self.status.see("end")
        self.status.configure(state="disabled")

    def generate(self) -> None:
        self.status.configure(state="normal")
        self.status.delete("1.0", "end")
        self.status.configure(state="disabled")

        file_path = self.file_var.get().strip()
        try:
            start = date.fromisoformat(self.start_var.get().strip())
        except ValueError:
            messagebox.showerror("Invalid date", "Start date must be in YYYY-MM-DD format.")
            return
        try:
            weeks = int(self.weeks_var.get().strip())
        except ValueError:
            messagebox.showerror("Invalid weeks", "Number of weeks must be a whole number.")
            return

        existed_before = os.path.exists(file_path)
        try:
            warnings = rg.build_roster(file_path, start, weeks, commit=self.commit_var.get())
        except rg.RosterInputError as e:
            messagebox.showerror("Could not generate roster", str(e))
            return
        except Exception as e:  # unexpected — show it rather than fail silently
            messagebox.showerror("Unexpected error", f"{e}\n\n{traceback.format_exc()}")
            return

        if not existed_before:
            self.log(f"Created a new planner workbook at:\n{file_path}")
            self.log("Please fill in the Staff and Leave tabs, then click Generate Roster again.")
            return

        if warnings:
            self.log("Roster generated with warnings:")
            for w in warnings:
                self.log(" - " + w)
        else:
            self.log("Roster generated successfully:")
        self.log(f"\n{file_path}")
        self.log("Open the workbook to see the Week tabs and Checks.")


def main() -> None:
    RosterApp().mainloop()


if __name__ == "__main__":
    main()
