import { describe, expect, it } from 'vitest';
import { parseXml } from './xml-parser.js';
import { XmlParseError } from '../../shared/errors.js';
import { loadFixture } from '../../../tests/fixtures/index.js';

describe('parseXml', () => {
  it('parses a real vPIC payload into a plain object', () => {
    const parsed = parseXml(loadFixture('get-all-makes.xml'), 'get-all-makes.xml') as {
      Response: { Results: { AllVehicleMakes: unknown[] } };
    };

    expect(parsed.Response.Results.AllVehicleMakes).toHaveLength(4);
  });

  it('keeps numeric-looking values as strings', () => {
    const parsed = parseXml('<Root><Id>0440</Id><Count>12</Count></Root>', 'test') as {
      Root: { Id: unknown; Count: unknown };
    };

    // A leading zero would be lost and an id would become a number, changing the
    // contract we serve and breaking equality against stored keys.
    expect(parsed.Root.Id).toBe('0440');
    expect(parsed.Root.Count).toBe('12');
  });

  it('strips XML namespace prefixes', () => {
    const parsed = parseXml(
      '<ns:Root xmlns:ns="http://example.test"><ns:Value>x</ns:Value></ns:Root>',
      'test',
    ) as { Root: { Value: string } };

    expect(parsed.Root.Value).toBe('x');
  });

  it('trims surrounding whitespace from values', () => {
    const parsed = parseXml('<Root><Name>  ASTON MARTIN  </Name></Root>', 'test') as {
      Root: { Name: string };
    };

    expect(parsed.Root.Name).toBe('ASTON MARTIN');
  });

  it('throws a typed error for malformed XML instead of returning a partial object', () => {
    expect(() => parseXml('<Response><Count>1</Count>', 'test')).toThrow(XmlParseError);
  });

  it('throws for an HTML error page with unclosed tags', () => {
    expect(() => parseXml('<html><body><br>502 Bad Gateway</body></html>', 'test')).toThrow(
      XmlParseError,
    );
  });

  it('accepts an HTML error page that happens to be well-formed XML', () => {
    // Not the parser's job to notice: a gateway page with balanced tags parses
    // fine and is rejected one layer up, where the envelope is validated.
    expect(() => parseXml('<html><body>502 Bad Gateway</body></html>', 'test')).not.toThrow();
  });

  it('throws for an empty document', () => {
    expect(() => parseXml('   ', 'upstream')).toThrow(XmlParseError);
  });

  it('names the source and location in the error', () => {
    try {
      parseXml('<a><b></a>', 'https://vpic.test/makes');
      expect.unreachable('parseXml should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(XmlParseError);
      const parseError = error as XmlParseError;
      expect(parseError.message).toContain('https://vpic.test/makes');
      expect(parseError.context.source).toBe('https://vpic.test/makes');
    }
  });
});
