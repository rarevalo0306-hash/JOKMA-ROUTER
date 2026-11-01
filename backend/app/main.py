from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import Settings, get_settings
from app.db import bind_database
from app.routers.admin import router as admin_router
from app.routers.v1 import APIError, router as v1_router


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        yield
        http = getattr(app.state, "http", None)
        if http is not None:
            await http.aclose()
        engine = getattr(app.state, "engine", None)
        if engine is not None:
            await engine.dispose()

    app = FastAPI(title="JOKMA Router", version="0.1.0", lifespan=lifespan)
    app.state.settings = settings
    bind_database(app, settings)
    app.state.http = httpx.AsyncClient(
        timeout=httpx.Timeout(settings.request_timeout_seconds, connect=10.0)
    )

    origins = [item.strip() for item in settings.cors_origins.split(",") if item.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins or ["http://localhost:3000"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(v1_router)
    app.include_router(admin_router)

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.exception_handler(APIError)
    async def api_error(_request: Request, exc: APIError):
        return JSONResponse(
            status_code=exc.status,
            content={"error": {"message": exc.message, "type": exc.error_type, "code": exc.code}},
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        if request.url.path.startswith("/v1"):
            return JSONResponse(
                status_code=422,
                content={
                    "error": {
                        "message": "Invalid request",
                        "type": "invalid_request_error",
                        "code": "invalid_request",
                    }
                },
            )
        return JSONResponse(status_code=422, content={"detail": exc.errors()})

    return app


app = create_app()
