<?php
// Starter exercise library and routines for a new account.

function seed_exercises(int $uid): void {
    if ((int) q_val('SELECT COUNT(*) FROM exercises WHERE user_id = ?', [$uid]) > 0) return;
    $list = [
        ['Bench press', 'Chest', 'Barbell'], ['Incline bench press', 'Chest', 'Barbell'], ['Incline dumbbell press', 'Chest', 'Dumbbell'],
        ['Dumbbell bench press', 'Chest', 'Dumbbell'], ['Chest fly', 'Chest', 'Cable'], ['Dip', 'Chest', 'Bodyweight'], ['Push-up', 'Chest', 'Bodyweight'],
        ['Overhead press', 'Shoulders', 'Barbell'], ['Seated dumbbell press', 'Shoulders', 'Dumbbell'], ['Lateral raise', 'Shoulders', 'Dumbbell'],
        ['Rear delt fly', 'Shoulders', 'Cable'], ['Face pull', 'Shoulders', 'Cable'],
        ['Pull-up', 'Back', 'Bodyweight'], ['Weighted pull-up', 'Back', 'Bodyweight'], ['Chin-up', 'Back', 'Bodyweight'], ['Lat pulldown', 'Back', 'Cable'],
        ['Barbell row', 'Back', 'Barbell'], ['Chest-supported row', 'Back', 'Dumbbell'], ['Seated cable row', 'Back', 'Cable'], ['One-arm dumbbell row', 'Back', 'Dumbbell'],
        ['Deadlift', 'Back', 'Barbell'], ['Romanian deadlift', 'Hamstrings', 'Barbell'], ['Back squat', 'Quads', 'Barbell'], ['Front squat', 'Quads', 'Barbell'],
        ['Leg press', 'Quads', 'Machine'], ['Hack squat', 'Quads', 'Machine'], ['Bulgarian split squat', 'Quads', 'Dumbbell'], ['Walking lunge', 'Quads', 'Dumbbell'],
        ['Leg extension', 'Quads', 'Machine'], ['Lying leg curl', 'Hamstrings', 'Machine'], ['Seated leg curl', 'Hamstrings', 'Machine'],
        ['Hip thrust', 'Glutes', 'Barbell'], ['Standing calf raise', 'Calves', 'Machine'], ['Seated calf raise', 'Calves', 'Machine'],
        ['Barbell curl', 'Biceps', 'Barbell'], ['Dumbbell curl', 'Biceps', 'Dumbbell'], ['Hammer curl', 'Biceps', 'Dumbbell'],
        ['Triceps pushdown', 'Triceps', 'Cable'], ['Overhead triceps extension', 'Triceps', 'Cable'], ['Skull crusher', 'Triceps', 'Barbell'],
        ['Hanging leg raise', 'Core', 'Bodyweight'], ['Cable crunch', 'Core', 'Cable'], ['Plank', 'Core', 'Bodyweight'],
        ['Side plank', 'Core', 'Bodyweight'], ['Dead hang', 'Forearms', 'Bodyweight'], ['Farmer carry', 'Full body', 'Dumbbell'],
    ];
    // Held for time rather than counted in reps: [usual hold in seconds, each side].
    $timed = ['Plank' => [45, 0], 'Side plank' => [30, 1], 'Dead hang' => [30, 0], 'Farmer carry' => [40, 0]];
    $ids = [];
    foreach ($list as [$n, $m, $e]) $ids[$n] = db_insert('exercises', ['user_id' => $uid, 'name' => $n, 'muscle' => $m, 'equipment' => $e, 'archived' => 0]);
    // Core work doesn't count toward lifting volume. (The column is missing on a database that hasn't upgraded yet.)
    try { q("UPDATE exercises SET kind = 'core' WHERE user_id = ? AND muscle = 'Core'", [$uid]); } catch (PDOException $e) {}
    try {
        q("UPDATE exercises SET kind = 'carry' WHERE id = ?", [$ids['Farmer carry']]);
        foreach ($timed as $n => [$sec, $side]) q("UPDATE exercises SET measure = 'time', hold_s = ?, per_side = ? WHERE id = ?", [$sec, $side, $ids[$n]]);
    } catch (PDOException $e) {}
    $routines = [
        'Upper A' => ['Bench press', 'Weighted pull-up', 'Overhead press', 'Chest-supported row', 'Lateral raise'],
        'Lower A' => ['Back squat', 'Romanian deadlift', 'Leg press', 'Lying leg curl', 'Standing calf raise'],
        'Upper B' => ['Incline dumbbell press', 'Lat pulldown', 'Seated dumbbell press', 'Seated cable row', 'Triceps pushdown', 'Dumbbell curl'],
        'Lower B' => ['Deadlift', 'Bulgarian split squat', 'Leg extension', 'Seated leg curl', 'Hanging leg raise'],
    ];
    foreach ($routines as $name => $exs) {
        db_insert('routines', ['user_id' => $uid, 'name' => $name, 'exercise_ids' => json_encode(array_map(fn($x) => $ids[$x], $exs))]);
    }
}
