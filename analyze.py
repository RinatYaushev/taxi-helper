#!/usr/bin/env python3
"""Швидкий аналіз грн/км і частки газу з data.json (без Excel)."""
import json

d = json.load(open("data.json"))
s = d["settings"]
fpk = s["gas_consumption_l_100km"] / 100 * s["gas_price_per_l"]
real = fpk * (1 + s["empty_run_coef"])
print(f"Паливо/км: {fpk:.2f} грн/км | з порожняком: {real:.2f} грн/км")
print("-" * 64)
for t in d["trips"]:
    a, dist, dt, z = t["amount"], t["distance"], t["datetime"], t["zone"]
    comm = a * s["commission_uklon_pct"] / 100
    if t["payment"] == "Безготівка":
        comm += a * s["commission_cashless_pct"] / 100
    gas = dist * (1 + s["empty_run_coef"]) * fpk
    net = a - comm - gas
    gpk, npk = a / dist, net / dist
    print(f"{dt}  {a:>3}грн {dist:>5}км  грн/км={gpk:5.1f}  чист/км={npk:5.1f}  {z}")
amt = sum(t["amount"] for t in d["trips"])
km = sum(t["distance"] for t in d["trips"])
gas = sum(t["distance"] * (1 + s["empty_run_coef"]) * fpk for t in d["trips"])
print("-" * 64)
print(f"Разом: {amt} грн, {km:.1f} км, газ {gas:.0f} грн "
      f"({gas / amt * 100:.0f}% виручки) | вал.грн/км={amt / km:.1f}")

