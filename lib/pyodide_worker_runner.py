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


async def install_imports(source_code):
    try:
        imports = pyodide.find_imports(source_code)
    except SyntaxError:
        return

    to_install = find_imports_to_install(imports)
    if to_install:
        try:
            import micropip  # noqa
        except ModuleNotFoundError:
            await pyodide_js.loadPackage("micropip")
            import micropip  # noqa

        to_package_name = pyodide_js._module._import_name_to_package_name.to_py()
        packages_names = [to_package_name.get(mod, mod) for mod in to_install]
        await micropip.install(packages_names)
