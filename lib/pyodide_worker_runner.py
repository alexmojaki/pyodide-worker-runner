import importlib
import sys

import pyodide  # noqa
import pyodide_js  # noqa

sys.setrecursionlimit(500)


def find_imports_to_install(imports):
    to_install = []
    for module in imports:
        try:
            importlib.import_module(module)
        except ModuleNotFoundError:
            to_install.append(module)
    return to_install

async def install_imports(source_code_or_imports, message_callback=lambda *args: None):
    if isinstance(source_code_or_imports, str):
        try:
            imports = pyodide.find_imports(source_code_or_imports)
        except SyntaxError:
            return
    else:
        imports = source_code_or_imports

    to_install = find_imports_to_install(imports)
    if to_install:
        def import_cb(typ, imports):
            return message_callback(dict(type=typ, imports=imports))
        
        to_package_name = pyodide_js._module._import_name_to_package_name.to_py()
        to_install_entries = [
            dict(module=mod, package=to_package_name.get(mod, mod)) for mod in to_install
        ]
        import_cb("loading", to_install_entries)
        try:
            import micropip  # noqa
        except ModuleNotFoundError:
            import_cb("loading", [dict(module="micropip", package="micropip")])
            await pyodide_js.loadPackage("micropip")
            import micropip  # noqa
            import_cb("loaded", [dict(module="micropip", package="micropip")])

        for entry in to_install:
            import_cb("loading", entry)
            await micropip.install(entry["package"])
            import_cb("loaded", entry)
        import_cb("loaded", to_install_entries)
