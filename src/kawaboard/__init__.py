import subprocess
import sys
from pathlib import Path

import capstone  # pyright: ignore[reportMissingTypeStubs]
import eel
import keystone  # pyright: ignore[reportMissingTypeStubs]


def web_dir() -> str:
    if getattr(sys, "frozen", False):
        return str(Path(sys._MEIPASS) / "web")  # pyright: ignore[reportUnknownMemberType, reportUnknownArgumentType, reportAttributeAccessIssue]
    return str(Path(__file__).resolve().parents[2] / "web")


cs16 = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_16)
cs32 = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_32)
cs64 = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)


@eel.expose
def disassemble(hex_string: str, mode: str = "16") -> str:
    hex_clean = hex_string.replace(" ", "").replace("0x", "").replace("0X", "")
    try:
        bytes_data = bytes.fromhex(hex_clean)
    except ValueError:
        return "Ошибка: невалидный hex"
    cs = {"16": cs16, "32": cs32, "64": cs64}.get(mode, cs16)
    try:
        insns = cs.disasm(bytes_data, 0x1000)  # pyright: ignore[reportUnknownMemberType]
        result = [f"{i.mnemonic} {i.op_str}" for i in insns]  # pyright: ignore[reportAny]
        return "\n".join(result) if result else "Нет инструкций"
    except Exception as e:  # noqa: BLE001
        return f"Ошибка дизассемблера: {e}"


@eel.expose
def assemble(asm_line: str, mode: str = "16") -> str:
    mode_map = {"16": keystone.KS_MODE_16, "32": keystone.KS_MODE_32, "64": keystone.KS_MODE_64}
    try:
        ks = keystone.Ks(keystone.KS_ARCH_X86, mode_map.get(mode, keystone.KS_MODE_16))
        encoding, _ = ks.asm(asm_line)  # pyright: ignore[reportUnknownVariableType, reportUnknownMemberType]
        if encoding:
            return " ".join(f"{b:02X}" for b in encoding)  # pyright: ignore[reportUnknownVariableType]
        return "Ошибка: не удалось сгенерировать код (проверьте синтаксис)"
    except keystone.KsError as e:
        return f"Ошибка Keystone: {e}"
    except Exception as e:  # noqa: BLE001
        return f"Неизвестная ошибка: {e}"


@eel.expose
def convert_base(value: str, from_base: str, to_base: str) -> str:
    base = {
        "Dec": 10,
        "Hex": 16,
        "Bin": 2,
        "Oct": 8,
    }[from_base]
    raw = "".join(value.split())
    if raw[0] == "0" and raw[1] in "oObBhH":
        raw = raw[2:]
    if not raw:
        return "Ошибка: пустая строка"
    try:
        num = int(raw, base)
    except ValueError:
        return f"Ошибка: неверное число для системы {from_base} (строка: '{raw}')"
    return {
        "Dec": str(num),
        "Hex": hex(num).upper().replace("0X", ""),
        "Bin": bin(num).replace("0b", ""),
        "Oct": oct(num).replace("0o", ""),
    }.get(to_base, f'Ошибка: неизвестная целевая система "{to_base}"')


def _tk_dialog(kind: str, default_name: str):
    import tkinter as tk
    from tkinter import filedialog

    root = tk.Tk()
    root.withdraw()
    try:
        _ = root.attributes("-topmost", True)  # pyright: ignore[reportUnknownMemberType]
    except Exception:  # noqa: BLE001, S110
        pass
    flt = [("Доска kawaboard", "*.kawadesk"), ("Все файлы", "*.*")]
    if kind == "save":
        path = filedialog.asksaveasfilename(
            title="Сохранить доску", defaultextension=".kawadesk", filetypes=flt, initialfile=default_name
        )
    else:
        path = filedialog.askopenfilename(title="Открыть доску", filetypes=flt)
    root.destroy()
    return path or None


def _ps_dialog(kind: str, default_name: str):
    head = "Add-Type -AssemblyName System.Windows.Forms;"
    if kind == "save":
        ps = (
            head + "$d = New-Object System.Windows.Forms.SaveFileDialog;"  # pyright: ignore[reportImplicitStringConcatenation]
            "$d.Filter = 'Доска kawaboard (*.kawadesk)|*.kawadesk|Все файлы (*.*)|*.*';"
            "$d.DefaultExt = 'kawadesk';"
            + f"$d.FileName = '{default_name}';"
            + "if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.FileName }"
        )
    else:
        ps = (
            head + "$d = New-Object System.Windows.Forms.OpenFileDialog;"  # pyright: ignore[reportImplicitStringConcatenation]
            "$d.Filter = 'Доска kawaboard (*.kawadesk)|*.kawadesk|Все файлы (*.*)|*.*';"
            "if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.FileName }"
        )
    r = subprocess.run(
        ["powershell", "-NoProfile", "-STA", "-Command", ps], capture_output=True, text=True, check=False
    )
    p = (r.stdout or "").strip()
    return p or None


def _ask_save(default_name):  # pyright: ignore[reportUnknownParameterType, reportMissingParameterType]
    try:
        return _tk_dialog("save", default_name)  # pyright: ignore[reportUnknownArgumentType]
    except Exception:  # noqa: BLE001, S110
        pass
    try:
        return _ps_dialog("save", default_name)  # pyright: ignore[reportUnknownArgumentType]
    except Exception:  # noqa: BLE001
        return None


def _ask_open():
    try:
        return _tk_dialog("open", "")
    except Exception:  # noqa: BLE001, S110
        pass
    try:
        return _ps_dialog("open", "")
    except Exception:  # noqa: BLE001
        return None


@eel.expose
def save_board_file(json_text: str, default_name: str = "kawaii-board.kawadesk"):
    path = _ask_save(default_name or "kawaii-board.kawadesk")
    if not path:
        return {"ok": False, "cancelled": True}
    if not path.lower().endswith(".kawadesk"):
        path += ".kawadesk"
    try:
        _ = Path(path).write_text(json_text, encoding="utf-8")
        return {"ok": True, "path": path}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}


@eel.expose
def open_board_file():
    path = _ask_open()
    if not path:
        return {"ok": False, "cancelled": True}
    try:
        return {"ok": True, "path": path, "content": Path(path).read_text(encoding="utf-8")}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}


# ---------- запуск ----------
def main():
    eel.init(web_dir())
    opts = {"size": (1000, 700), "port": 0}
    for mode in ("chrome", "edge", "electron"):
        try:
            eel.start("index.html", mode=mode, **opts)  # pyright: ignore[reportArgumentType]
            return
        except KeyboardInterrupt, SystemExit:
            return
        except Exception as e:  # noqa: BLE001
            print(f'[kawaboard] браузер "{mode}" не подошёл: {e}')
    raise SystemExit("[kawaboard] не нашлось ни одного поддерживаемого браузера T_T")
