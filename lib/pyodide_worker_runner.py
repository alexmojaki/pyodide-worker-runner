import importlib
import sys
from typing import Callable, Literal, Union, TypedDict

try:
    from pyodide.code import find_imports  # noqa
except ImportError:
    from pyodide import find_imports  # noqa

import pyodide_js  # noqa

sys.setrecursionlimit(400)


class InstallEntry(TypedDict):
    module: str
    package: str


def find_imports_to_install(imports: list[str]) -> list[InstallEntry]:
    """
    Given a list of module names being imported, return a list of dicts
    representing the packages that need to be installed to import those modules.
    The returned list will only contain modules that aren't already installed.
    Each returned dict has the following keys:
      - module: the name of the module being imported
      - package: the name of the package that needs to be installed
    """
    try:
        to_package_name = pyodide_js._module._import_name_to_package_name.to_py()
    except AttributeError:
        to_package_name = pyodide_js._api._import_name_to_package_name.to_py()

    to_install: list[InstallEntry] = []
    for module in imports:
        try:
            importlib.import_module(module)
        except ModuleNotFoundError:
            to_install.append(
                dict(
                    module=module,
                    package=to_package_name.get(module, module),
                )
            )
    return to_install


async def install_imports(
    source_code_or_imports: Union[str, list[str]],
    message_callback: Callable[
        [
            Literal[
                "loading_all",
                "loaded_all",
                "loading_one",
                "loaded_one",
                "loading_micropip",
                "loaded_micropip",
            ],
            Union[InstallEntry, list[InstallEntry]],
        ],
        None,
    ] = lambda event_type, data: None,
):
    """
    Accepts a string of Python source code or a list of module names being imported.
    Installs any packages that need to be installed to import those modules,
    using micropip, which may also be installed if needed.
    If the package is not specially built for Pyodide, it must be available on PyPI
    as a pure Python wheel file.
    If the `message_callback` argument is provided, it will be called with an
    event type and data about the packages being installed.
    The event types start with `loading_` before installation, and `loaded_` after.
    The data is either a single dict representing the package being installed,
    or a list of all the packages being installed.
    The events are:
        - loading/loaded_all, with a list of all the packages being installed.
        - loading/loaded_one, with a dict for a single package.
        - loading/loaded_micropip, with a dict for the special micropip package.
    """
    if isinstance(source_code_or_imports, str):
        try:
            imports: list[str] = find_imports(source_code_or_imports)
        except SyntaxError:
            return
    else:
        imports: list[str] = source_code_or_imports

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
