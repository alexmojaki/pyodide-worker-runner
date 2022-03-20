import importlib
import sys

import pyodide  # noqa
import pyodide_js  # noqa

sys.setrecursionlimit(500)

from python_runner import PatchedStdinRunner


class Runner(PatchedStdinRunner):
    def readline(self, *args, **kwargs):
        try:
            return super().readline(*args, **kwargs)
        except BaseException as e:
            typ = getattr(e.js_error, "type", None)
            if typ == "InterruptError":
                raise KeyboardInterrupt from None
            elif typ == "ServiceWorkerError":
                raise RuntimeError(
                    "The service worker for reading input isn't working. "
                    "Try closing all this site's tabs, then reopening. "
                    "If that doesn't work, try using a different browser."
                ) from None
            elif typ == "NoChannelError":
                raise RuntimeError(
                    "This browser doesn't support reading input. "
                    "Try upgrading to the most recent version or switching to a different browser, "
                    "e.g. Chrome or Firefox."
                ) from None
            else:
                raise


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
