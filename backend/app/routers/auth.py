from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from datetime import timedelta
import time
from collections import defaultdict
from .. import crud, schemas, database, dependencies

router = APIRouter(prefix="/api/auth", tags=["Authentication"])

class RateLimiter:
    def __init__(self, requests_limit: int, window_seconds: int):
        self.requests_limit = requests_limit
        self.window_seconds = window_seconds
        self.history = defaultdict(list)

    def is_rate_limited(self, ip: str) -> bool:
        now = time.time()
        # Clean old records outside the sliding window
        self.history[ip] = [t for t in self.history[ip] if now - t < self.window_seconds]
        if len(self.history[ip]) >= self.requests_limit:
            return True
        self.history[ip].append(now)
        return False

# Limit user registration to 5 requests per 10 minutes to prevent registration spam
register_limiter = RateLimiter(requests_limit=5, window_seconds=600)
# Limit login attempts to 10 requests per minute to prevent credential stuffing/brute force
login_limiter = RateLimiter(requests_limit=10, window_seconds=60)

@router.post("/register", response_model=schemas.User)
def register_user(request: Request, user: schemas.UserCreate, db: Session = Depends(database.get_db)):
    client_ip = request.client.host if request.client else "127.0.0.1"
    if register_limiter.is_rate_limited(client_ip):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many registration attempts. Please try again later."
        )
    db_user = crud.get_user_by_email(db, email=user.email)
    if db_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    return crud.create_user(db=db, user=user)

@router.post("/token", response_model=schemas.Token)
def login_for_access_token(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(database.get_db)
):
    client_ip = request.client.host if request.client else "127.0.0.1"
    if login_limiter.is_rate_limited(client_ip):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts. Please try again later."
        )
    user = crud.get_user_by_email(db, email=form_data.username)
    if not user or not dependencies.verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token = dependencies.create_access_token(
        data={"sub": user.email}
    )
    return {"access_token": access_token, "token_type": "bearer"}

@router.get("/me", response_model=schemas.User)
def read_users_me(current_user: schemas.User = Depends(dependencies.get_current_user)):
    return current_user
