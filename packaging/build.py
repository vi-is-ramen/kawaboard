import os
import sys


def main(argv: list[str]):
    onefile = "--onefile" in argv
    from PyInstaller.__main__ import run as pyi

    sep = os.pathsep
    args = [
        os.path.join("src", "kawaboard", "__main__.py"),
        "--name",
        "kawaboard",
        "--noconfirm",
        "--clean",
        "--paths",
        "src",
        "--add-data",
        f"web{sep}web",
        "--collect-all",
        "eel",
        "--collect-binaries",
        "capstone",
        "--collect-binaries",
        "keystone",
        "--hidden-import",
        "bottle_websocket",
        "--hidden-import",
        "geventwebsocket",
        "--onefile" if onefile else "--onedir",
    ]
    pyi(args)


if __name__ == "__main__":
    main(sys.argv[1:])
