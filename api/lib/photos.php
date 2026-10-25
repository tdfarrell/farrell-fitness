<?php
// Progress photos. Files live in data/photos/<user>/, which the web server never serves directly;
// they're only sent through photos/file to a signed-in owner. The app resizes each photo and
// strips its metadata (location, camera) in the browser before upload.

const PHOTO_POSES = ['front', 'side', 'back'];
const PHOTO_MAX_BYTES = 6 * 1024 * 1024;

function photo_dir(int $uid): string {
    $base = config()['data_dir'] ?? (__DIR__ . '/../../data');
    $dir = rtrim($base, '/') . "/photos/u$uid";
    if (!is_dir($dir)) mkdir($dir, 0700, true);
    return $dir;
}

function photo_out(array $r): array {
    return ['id' => (int) $r['id'], 'date' => $r['date'], 'pose' => $r['pose'], 'width' => $r['width'] === null ? null : (int) $r['width'],
        'height' => $r['height'] === null ? null : (int) $r['height'], 'created_at' => (int) $r['created_at']];
}

function route_photos(int $uid, string $m) {
    return ['photos' => array_map('photo_out', q_all('SELECT * FROM progress_photos WHERE user_id = ? ORDER BY date DESC, pose', [$uid]))];
}

/** Decode a base64 JPEG (optionally a data: URL) and check it really is one. */
function decode_jpeg(string $b64, int $maxBytes): array {
    if (str_starts_with($b64, 'data:')) $b64 = substr($b64, strpos($b64, ',') + 1);
    $bin = base64_decode($b64, true);
    if ($bin === false || strlen($bin) < 100) fail(400, 'That photo could not be read');
    if (strlen($bin) > $maxBytes) fail(400, 'That photo is too large');
    if (substr($bin, 0, 3) !== "\xFF\xD8\xFF") fail(400, 'Photos must be JPEG');
    $info = @getimagesizefromstring($bin);
    if (!$info || $info[2] !== IMAGETYPE_JPEG) fail(400, 'Photos must be JPEG');
    return [$bin, (int) $info[0], (int) $info[1]];
}

/** One photo per pose per day; a new one replaces the old. */
function route_photos_upload(int $uid, string $m) {
    if ($m !== 'POST') fail(405, 'Use POST');
    $date = req_date();
    $pose = (string) param('pose', 'front');
    if (!in_array($pose, PHOTO_POSES, true)) fail(400, 'Pose must be front, side or back');
    [$bin, $w, $h] = decode_jpeg((string) param('data', ''), PHOTO_MAX_BYTES);
    $thumb = param('thumb') ? decode_jpeg((string) param('thumb'), 1024 * 1024)[0] : null;

    $dir = photo_dir($uid);
    $name = bin2hex(random_bytes(12));
    file_put_contents("$dir/$name.jpg", $bin, LOCK_EX);
    chmod("$dir/$name.jpg", 0600);
    if ($thumb !== null) { file_put_contents("$dir/$name-t.jpg", $thumb, LOCK_EX); chmod("$dir/$name-t.jpg", 0600); }

    $old = q_one('SELECT * FROM progress_photos WHERE user_id = ? AND date = ? AND pose = ?', [$uid, $date, $pose]);
    if ($old) { photo_unlink($uid, $old); q('DELETE FROM progress_photos WHERE id = ?', [$old['id']]); }
    $id = db_insert('progress_photos', ['user_id' => $uid, 'date' => $date, 'pose' => $pose, 'file' => "$name.jpg",
        'thumb' => $thumb !== null ? "$name-t.jpg" : null, 'width' => $w, 'height' => $h, 'created_at' => time()]);
    return ['photo' => photo_out(q_one('SELECT * FROM progress_photos WHERE id = ?', [$id]))];
}

function photo_unlink(int $uid, array $row): void {
    $dir = photo_dir($uid);
    foreach ([$row['file'], $row['thumb']] as $f) if ($f && preg_match('/^[a-f0-9]{24}(-t)?\.jpg$/', $f)) @unlink("$dir/$f");
}

/** Streams the image itself (not JSON). size=thumb returns the small version when there is one. */
function route_photos_file(int $uid, string $m) {
    $row = q_one('SELECT * FROM progress_photos WHERE id = ? AND user_id = ?', [(int) req_num('id'), $uid]);
    if (!$row) fail(404, 'Photo not found');
    $file = param('size') === 'thumb' && $row['thumb'] ? $row['thumb'] : $row['file'];
    if (!preg_match('/^[a-f0-9]{24}(-t)?\.jpg$/', $file)) fail(404, 'Photo not found');
    $path = photo_dir($uid) . "/$file";
    if (!is_file($path)) fail(404, 'Photo file is missing');
    header('Content-Type: image/jpeg');
    header('Content-Length: ' . filesize($path));
    header('Cache-Control: private, max-age=604800, immutable');
    header('X-Content-Type-Options: nosniff');
    readfile($path);
    exit;
}

function route_photos_delete(int $uid, string $m) {
    $row = q_one('SELECT * FROM progress_photos WHERE id = ? AND user_id = ?', [(int) req_num('id'), $uid]);
    if ($row) { photo_unlink($uid, $row); q('DELETE FROM progress_photos WHERE id = ?', [$row['id']]); }
    return ['ok' => true];
}
