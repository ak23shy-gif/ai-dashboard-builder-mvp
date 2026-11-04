import asyncio
import io
import zipfile

from backend.excel_report import build_ga4_excel_report


class FakeGA4:
    async def discover(self):
        return []

    async def extract(self, query):
        dims = tuple(query.dimensions)
        if dims == ("yearMonth",):
            metrics = {metric: 10 for metric in query.metrics}
            metrics.update({"sessions": 100, "activeUsers": 70, "screenPageViews": 250, "userEngagementDuration": 3500})
            yield [{"yearMonth": "202610", **metrics}]
        elif dims == ("yearMonth", "eventName"):
            yield [{"yearMonth": "202610", "eventName": "book_viewing", "keyEvents": 4}]
        elif dims == ("yearMonth", "sessionDefaultChannelGroup", "eventName"):
            yield [{"yearMonth": "202610", "sessionDefaultChannelGroup": "Paid Search", "eventName": "book_viewing", "keyEvents": 2}]
        elif dims == ("yearMonth", "sessionDefaultChannelGroup"):
            yield [{"yearMonth": "202610", "sessionDefaultChannelGroup": "Organic Search", "sessions": 60, "activeUsers": 45, "engagedSessions": 40, "keyEvents": 3}]
        elif dims == ("date",):
            yield [{"date": "20261001", "sessions": 5, "activeUsers": 4, "engagedSessions": 3, "screenPageViews": 12, "keyEvents": 1}]
        elif dims == ("eventName",):
            yield [{"eventName": "book_viewing", "eventCount": 4, "activeUsers": 3, "keyEvents": 4}]
        else:
            yield []


def test_build_ga4_excel_report_matches_report_pack_shape():
    spec = {"start": "2026-01-01", "end": "2026-10-31"}
    sources = [{"connection_id": "user", "resource": "properties/1", "name": "Website", "status": "complete"}]
    content, warnings = asyncio.run(build_ga4_excel_report(spec, sources, lambda product, connection: FakeGA4()))
    assert content.startswith(b"PK\x03\x04")
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        workbook_xml = archive.read("xl/workbook.xml").decode("utf-8")
        strings = archive.read("xl/sharedStrings.xml").decode("utf-8")
    assert 'name="Monthly 2026-2026"' in workbook_xml
    assert 'name="Channels monthly"' in workbook_xml
    assert 'name="Google Ads campaigns Oct"' in workbook_xml
    assert 'name="Landing pages Oct"' in workbook_xml
    assert 'name="Not in GA4"' in workbook_xml
    assert "Paid Search leads" in strings
    assert "Phone calls (Infinity)" in strings
    assert warnings == []
