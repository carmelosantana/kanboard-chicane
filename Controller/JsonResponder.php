<?php
namespace Kanboard\Plugin\Chicane\Controller;

use Kanboard\Plugin\Chicane\Model\Json;

// The one JSON path for Chicane's endpoints: always a JSON object, an ETag, and 304 when If-None-Match matches.
// Pass $etag to choose what counts as "changed" (the race state ignores its `generated` stamp); default is the body.
trait JsonResponder
{
    protected function sendJson(array $data, ?string $etag = null): void
    {
        $body = Json::encode((object) $data);
        $etag ??= sha1($body);

        $this->response->withHeader('ETag', '"'.$etag.'"');
        $this->response->withHeader('Cache-Control', 'no-cache');
        if (self::etagMatches($this->request->getHeader('If-None-Match'), $etag)) {
            $this->response->status(304);
            return;
        }

        $this->response->withContentType('application/json');
        $this->response->withBody($body);
        $this->response->send();
    }

    private static function etagMatches(string $ifNoneMatch, string $etag): bool
    {
        foreach (explode(',', $ifNoneMatch) as $candidate) {
            $candidate = trim($candidate);
            if ($candidate === '*' || trim(preg_replace('/^W\//', '', $candidate), '"') === $etag) {
                return true;
            }
        }
        return false;
    }
}
