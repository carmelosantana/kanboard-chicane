<?php
namespace Kanboard\Plugin\Chicane\Model;

// The one JSON encoder for response bodies and ETags, so the two can't drift. Invalid UTF-8 (a pasted
// title, say) becomes U+FFFD instead of making json_encode return false and every ETag sha1(''). Floats keep
// their decimal (progress_pct 80.0, not 80).
final class Json
{
    public static function encode(mixed $data): string
    {
        return json_encode($data, JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PRESERVE_ZERO_FRACTION);
    }
}
