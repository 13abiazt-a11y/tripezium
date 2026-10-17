from app.services.travel import Stop, estimate, fit_day

# Real Tokyo coordinates
SENSOJI = (35.7148, 139.7967)
NAKAMISE = (35.7119, 139.7964)      # ~0.3 km from Senso-ji
SHIBUYA = (35.6595, 139.7005)       # ~10 km from Asakusa
HAKONE = (35.2324, 139.1069)        # ~90 km from Tokyo


def stop(time, mins, coords):
    return Stop(time, mins, *coords) if coords else Stop(time, mins, None, None)


def test_next_door_is_a_short_walk():
    leg = estimate(stop("09:00", 60, SENSOJI), stop("10:00", 60, NAKAMISE))
    assert leg.mode == "walk" and leg.mins == 10 and leg.km < 1   # 0.4 km ~ 5.3 min, rounded up to 10


def test_across_the_city_is_public_transport():
    leg = estimate(stop("09:00", 60, SENSOJI), stop("11:00", 60, SHIBUYA))
    assert leg.mode == "transit"
    assert 30 <= leg.mins <= 50            # roughly what Asakusa -> Shibuya takes by metro


def test_day_trip_distance_is_a_train():
    leg = estimate(stop("09:00", 60, SHIBUYA), stop("12:00", 60, HAKONE))
    assert leg.mode == "train" and 90 <= leg.mins <= 150


def test_no_coordinates_no_guess():
    assert estimate(stop("09:00", 60, SENSOJI), stop("10:00", 60, None)) is None


def test_back_to_back_across_town_is_pushed_later():
    times, legs = fit_day([stop("09:00", 60, SENSOJI), stop("10:00", 60, SHIBUYA), stop("11:30", 60, SHIBUYA)])
    assert legs[0] is None and legs[1].mode == "transit"
    assert times[0] == "09:00"
    assert times[1] == f"{10 + legs[1].mins // 60:02d}:{legs[1].mins % 60:02d}"  # 10:00 + travel
    # the knock-on: stop 3 starts no earlier than stop 2 ends (+ a 5-min walk at most)
    h, m = map(int, times[1].split(":"))
    assert times[2] >= f"{(h * 60 + m + 60) // 60:02d}:{(h * 60 + m + 60) % 60:02d}"


def test_enough_time_is_left_alone():
    times, _ = fit_day([stop("09:00", 60, SENSOJI), stop("10:30", 60, NAKAMISE)])
    assert times == ["09:00", "10:30"]       # never moves anything earlier or tighter


def test_missing_coordinates_keep_the_planned_gap():
    times, legs = fit_day([stop("09:00", 60, SENSOJI), stop("10:00", 60, None)])
    assert times == ["09:00", "10:00"] and legs == [None, None]


def test_overlapping_stops_are_separated_even_without_travel():
    times, _ = fit_day([stop("09:00", 90, None), stop("10:00", 60, None)])
    assert times == ["09:00", "10:30"]       # can't start before the previous stop ends
