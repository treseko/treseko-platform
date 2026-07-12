from .app_factory import create_app, exported_route_symbols


app = create_app()
globals().update(exported_route_symbols)
