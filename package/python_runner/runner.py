import ast
import builtins
import linecache
import logging
import os
import sys
import time
from code import InteractiveConsole
from collections.abc import Awaitable
from contextlib import contextmanager
from types import ModuleType

from .output import OutputBuffer

log = logging.getLogger(__name__)


class Runner:
    OutputBufferClass = OutputBuffer

    def __init__(
        self,
        *,
        callback=None,
        source_code="",
        filename="my_program.py",
    ):
        self.set_callback(callback)
        self.set_filename(filename)
        self.set_source_code(source_code)
        self.console = InteractiveConsole()
        self.output_buffer = self.OutputBufferClass(
            lambda parts: self.callback("output", parts=parts)
        )
        self.reset()

    def set_callback(self, callback):
        self._callback = callback

    def set_filename(self, filename):
        self.filename = os.path.normcase(os.path.abspath(filename))

    def set_source_code(self, source_code):
        self.source_code = source_code
        # Write to file if permitted by system
        try:
            with open(self.filename, "w") as f:
                f.write(self.source_code)
        except:  # pragma: no cover
            pass 
        linecache.cache[self.filename] = (
            len(self.source_code),
            0,
            [line + "\n" for line in self.source_code.splitlines()],
            self.filename,
        )


    def callback(self, event_type, **data):
        if event_type != "output":
            self.output_buffer.flush()

        return self._callback(event_type, data)

    def output(self, output_type, text, **extra):
        return self.output_buffer.put(output_type, text, **extra)

    def execute(self, code_obj, mode=None, snoop_config=None):  # noqa
        if mode == "snoop":
            from .snoop import exec_snoop, SnoopStream
            default_config = dict(columns=(), out=SnoopStream(self.output_buffer), color=False)
            exec_snoop(self, code_obj, snoop_config={**default_config, **(snoop_config or {})})
        else:
            return eval(code_obj, self.console.locals)  # noqa

    @contextmanager
    def _execute_context(self):
        with self.output_buffer.redirect_std_streams():
            try:
                yield
            except BaseException as e:
                self.output("traceback", **self.serialize_traceback(e))
        self.post_run()

    def run(self, source_code, mode="exec", snoop_config=None):
        code_obj = self.pre_run(source_code, mode=mode)
        with self._execute_context():
            if code_obj:
                return self.execute(code_obj, mode=mode, snoop_config=snoop_config)

    async def run_async(self, source_code, mode="exec", top_level_await=True, snoop_config=None):
        code_obj = self.pre_run(source_code, mode, top_level_await=top_level_await)
        with self._execute_context():
            if code_obj:
                result = self.execute(code_obj, mode=mode, snoop_config=snoop_config)
                while isinstance(result, Awaitable):
                    result = await result
                return result

    def serialize_traceback(self, exc):  # noqa
        raise NotImplementedError  # pragma: no cover

    def serialize_syntax_error(self, exc):
        return self.serialize_traceback(exc)

    def pre_run(self, source_code, mode="exec", top_level_await=False):
        compile_mode = mode
        if mode == "single":
            source_code += "\n"  # Allow compiling single-line compound statements
        elif mode != "eval":
            compile_mode = "exec"
            self.reset()
        self.output_buffer.reset()

        self.set_source_code(source_code)

        try:
            return compile(
                self.source_code,
                self.filename,
                compile_mode,
                flags=top_level_await * ast.PyCF_ALLOW_TOP_LEVEL_AWAIT,
            )
        except SyntaxError as e:
            try:
                if not ast.parse(self.source_code).body:
                    # Code is only comments, which cannot be compiled in 'single' mode
                    return
            except SyntaxError:
                pass

            self.output("syntax_error", **self.serialize_syntax_error(e))

    def post_run(self):
        self.output_buffer.flush()

    def reset(self):
        mod = ModuleType("__main__")
        mod.__file__ = self.filename
        sys.modules["__main__"] = mod
        self.console.locals = mod.__dict__
        self.output_buffer.reset()


class FakeStdin:
    def __init__(self, readline):
        self.readline = readline

    def __getattr__(self, item):
        return getattr(sys.__stdin__, item)

    def __next__(self):
        return self.readline()

    def __iter__(self):
        return self


class PatchedStdinRunner(Runner):  # noqa
    def pre_run(self, *args, **kwargs):
        sys.stdin = FakeStdin(self.readline)
        builtins.input = self.input
        return super().pre_run(*args, **kwargs)

    def reset(self):
        super().reset()
        self.line = ""

    def non_str_input(self, value):
        raise TypeError(f"Callback for input should return str, not {type(value).__name__}")

    def readline(self, n=-1, prompt=""):
        if not self.line and n:
            value = self.callback("input", prompt=prompt)
            if not isinstance(value, str):
                value = self.non_str_input(value) or ""
            if not value.endswith("\n"):
                value += "\n"
            self.output("input", value)
            self.line = value

        if n < 0 or n > len(self.line):
            n = len(self.line)
        to_return = self.line[:n]
        self.line = self.line[n:]
        return to_return

    def input(self, prompt=""):
        self.output("input_prompt", prompt)
        return self.readline(prompt=prompt)[:-1]  # Remove trailing newline


class PatchedSleepRunner(Runner):  # noqa
    def pre_run(self, *args, **kwargs):
        time.sleep = self.sleep
        return super().pre_run(*args, **kwargs)

    def sleep(self, seconds):
        if not isinstance(seconds, (int, float)):
            raise TypeError(f"an integer is required (got type {type(seconds).__name__})")
        if not seconds >= 0:
            raise ValueError("sleep length must be non-negative")
        return self.callback("sleep", seconds=seconds)


class PyodideRunner(PatchedStdinRunner, PatchedSleepRunner):  # noqa # pragma: no cover
    ServiceWorkerError = RuntimeError(
        "The service worker for reading input isn't working. "
        "Try closing all this site's tabs, then reopening. "
        "If that doesn't work, try using a different browser."
    )

    NoChannelError = RuntimeError(
        "This browser doesn't support reading input. "
        "Try upgrading to the most recent version or switching to a different browser, "
        "e.g. Chrome or Firefox."
    )
    InterruptError = KeyboardInterrupt

    def pyodide_error(self, e: Exception):
        import pyodide  # noqa

        js_error = e.js_error  # type: ignore
        typ = getattr(js_error, "type", "")
        err = getattr(self, typ, None)
        if err:
            raise err from None
        else:
            raise

    def readline(self, *args, **kwargs):
        try:
            return super().readline(*args, **kwargs)
        except Exception as e:
            self.pyodide_error(e)

    def sleep(self, *args, **kwargs):
        try:
            return super().sleep(*args, **kwargs)
        except Exception as e:
            try:
                self.pyodide_error(e)
            except RuntimeError as re:
                if re not in (self.ServiceWorkerError, self.NoChannelError):
                    raise
