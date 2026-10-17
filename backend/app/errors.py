"""Every error leaves the API as {"error": "<code>", "message": "<human-readable>"}."""
import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("app.errors")

_HTTP_CODES = {
    400: "bad_request",
    404: "not_found",
    405: "method_not_allowed",
    429: "rate_limited",
}


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status = status
        self.code = code
        self.message = message


def not_found(what: str, id_: str) -> ApiError:
    return ApiError(404, "not_found", f"{what} '{id_}' not found")


def _body(code: str, message: str, status: int) -> JSONResponse:
    return JSONResponse({"error": code, "message": message}, status_code=status)


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError):
        return _body(exc.code, exc.message, exc.status)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException):
        code = _HTTP_CODES.get(exc.status_code, "http_error")
        return _body(code, str(exc.detail), exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError):
        parts = []
        for err in exc.errors()[:5]:
            loc = ".".join(str(p) for p in err["loc"] if p != "body")
            parts.append(f"{loc}: {err['msg']}" if loc else err["msg"])
        return _body("validation_error", "; ".join(parts), 422)

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception):
        log.exception("unhandled error on %s %s", request.method, request.url.path)
        return _body("internal_error", "Something went wrong on our side.", 500)
