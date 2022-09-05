import importlib
import sys

import pyodide  # noqa
import pyodide_js  # noqa

sys.setrecursionlimit(400)


def find_imports_to_install(imports):
    try:
        to_package_name = pyodide_js._module._import_name_to_package_name.to_py()
    except AttributeError:
        to_package_name = pyodide_js._api._import_name_to_package_name.to_py()

    to_install = []
    for module in imports:
        try:
            importlib.import_module(module)
        except ModuleNotFoundError:
            to_install.append(dict(module=module, package=to_package_name.get(module, module)))
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
        message_callback("loading_all", to_install)
        try:
            import micropip  # noqa
        except ModuleNotFoundError:
            micropip_entry = dict(module="micropip", package="micropip")
            message_callback("loading_micropip", micropip_entry)
            await pyodide_js.loadPackage("micropip")
            import micropip  # noqa
            message_callback("loaded_micropip", micropip_entry)

        for entry in to_install:
            message_callback("loading_one", entry)
            await micropip.install(entry["package"])
            message_callback("loaded_one", entry)
        message_callback("loaded_all", to_install)
